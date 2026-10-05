use std::io::Cursor;

use bytes::Bytes;
use image::{
    DynamicImage, ImageDecoder, ImageFormat, ImageReader, Rgb, RgbImage, codecs::jpeg::JpegEncoder,
    imageops::FilterType, metadata::Orientation,
};
use img_parts::{ImageEXIF, jpeg::Jpeg, png::Png, webp::WebP};

const THUMBNAIL_SIZE: u32 = 400;

pub struct Processed {
    pub original: Bytes,
    pub format: ImageFormat,
    pub width: u32,
    pub height: u32,
    pub thumbnail: Bytes,
    pub resized: bool,
}

#[derive(Debug)]
pub enum ProcessError {
    Unsupported,
    Invalid(String),
    Encode(String),
}

/// Downscales to fit `max_size` and re-encodes as JPEG; GIFs are left alone to keep animation.
pub fn process(data: Bytes, max_size: Option<u32>) -> Result<Processed, ProcessError> {
    let format = image::guess_format(&data).map_err(|_| ProcessError::Unsupported)?;
    if !matches!(
        format,
        ImageFormat::Jpeg | ImageFormat::Png | ImageFormat::WebP | ImageFormat::Gif
    ) {
        return Err(ProcessError::Unsupported);
    }

    let mut decoder = ImageReader::with_format(Cursor::new(&data), format)
        .into_decoder()
        .map_err(|e| ProcessError::Invalid(e.to_string()))?;
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let mut img =
        DynamicImage::from_decoder(decoder).map_err(|e| ProcessError::Invalid(e.to_string()))?;
    img.apply_orientation(orientation);

    let too_big = |max: u32| img.width() > max || img.height() > max;
    if let Some(max) = max_size.filter(|&max| format != ImageFormat::Gif && too_big(max)) {
        let small = img.resize(max, max, FilterType::Lanczos3);
        return Ok(Processed {
            original: jpeg(&small, 92)?,
            format: ImageFormat::Jpeg,
            width: small.width(),
            height: small.height(),
            thumbnail: thumbnail(&small)?,
            resized: true,
        });
    }

    let original = match strip_metadata(data, format, orientation) {
        Some(stripped) => stripped,
        None => encode(&img, format)?,
    };

    Ok(Processed {
        original,
        format,
        width: img.width(),
        height: img.height(),
        thumbnail: thumbnail(&img)?,
        resized: false,
    })
}

/// Removes EXIF/XMP/IPTC (e.g. GPS location) but keeps ICC colour profiles and orientation.
/// None means the format can't carry the orientation, so the caller must re-encode upright.
fn strip_metadata(data: Bytes, format: ImageFormat, orientation: Orientation) -> Option<Bytes> {
    use img_parts::jpeg::markers::{APP1, APP13};

    let exif = (orientation != Orientation::NoTransforms).then(|| orientation_exif(orientation));
    let stripped = match format {
        ImageFormat::Jpeg => match Jpeg::from_bytes(data.clone()) {
            Ok(mut jpeg) => {
                jpeg.remove_segments_by_marker(APP1);
                jpeg.remove_segments_by_marker(APP13);
                jpeg.set_exif(exif);
                jpeg.encoder().bytes()
            }
            Err(_) => data,
        },
        ImageFormat::WebP => match WebP::from_bytes(data.clone()) {
            Ok(mut webp) => {
                webp.set_exif(exif);
                webp.remove_chunks_by_id(img_parts::webp::CHUNK_XMP);
                webp.encoder().bytes()
            }
            Err(_) => data,
        },
        _ if exif.is_some() => return None,
        ImageFormat::Png => match Png::from_bytes(data.clone()) {
            Ok(mut png) => {
                for kind in [*b"eXIf", *b"tEXt", *b"zTXt", *b"iTXt"] {
                    png.remove_chunks_by_type(kind);
                }
                png.encoder().bytes()
            }
            Err(_) => data,
        },
        _ => data,
    };
    Some(stripped)
}

/// A big-endian TIFF header with a single IFD entry: the orientation tag.
fn orientation_exif(orientation: Orientation) -> Bytes {
    let mut exif = b"MM\0\x2a\0\0\0\x08\0\x01\x01\x12\0\x03\0\0\0\x01".to_vec();
    exif.extend_from_slice(&[0, orientation.to_exif(), 0, 0, 0, 0, 0, 0]);
    exif.into()
}

fn encode(img: &DynamicImage, format: ImageFormat) -> Result<Bytes, ProcessError> {
    let mut out = Vec::new();
    let result = match format {
        ImageFormat::Jpeg => img
            .to_rgb8()
            .write_with_encoder(JpegEncoder::new_with_quality(&mut out, 92)),
        _ => img.write_to(&mut Cursor::new(&mut out), format),
    };
    result.map_err(|e| ProcessError::Encode(e.to_string()))?;
    Ok(out.into())
}

fn thumbnail(img: &DynamicImage) -> Result<Bytes, ProcessError> {
    if img.width() > THUMBNAIL_SIZE || img.height() > THUMBNAIL_SIZE {
        jpeg(&img.thumbnail(THUMBNAIL_SIZE, THUMBNAIL_SIZE), 80)
    } else {
        jpeg(img, 80)
    }
}

fn jpeg(img: &DynamicImage, quality: u8) -> Result<Bytes, ProcessError> {
    // JPEG has no alpha, so flatten onto white.
    let rgba = img.to_rgba8();
    let flat = RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let [r, g, b, a] = rgba.get_pixel(x, y).0;
        let blend = |c: u8| ((c as u32 * a as u32 + 255 * (255 - a as u32)) / 255) as u8;
        Rgb([blend(r), blend(g), blend(b)])
    });

    let mut out = Vec::new();
    flat.write_with_encoder(JpegEncoder::new_with_quality(&mut out, quality))
        .map_err(|e| ProcessError::Encode(e.to_string()))?;
    Ok(out.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(width: u32, height: u32) -> Bytes {
        let mut out = Vec::new();
        DynamicImage::new_rgba8(width, height)
            .write_to(&mut Cursor::new(&mut out), ImageFormat::Png)
            .unwrap();
        out.into()
    }

    #[test]
    fn oversized_images_are_resized_to_jpeg() {
        let processed = process(png(3000, 1000), Some(1200)).unwrap();
        assert!(processed.resized);
        assert_eq!(processed.format, ImageFormat::Jpeg);
        assert_eq!((processed.width, processed.height), (1200, 400));
        assert_eq!(
            image::guess_format(&processed.original).unwrap(),
            ImageFormat::Jpeg
        );
    }

    #[test]
    fn images_within_max_size_keep_their_format() {
        let processed = process(png(800, 600), Some(1200)).unwrap();
        assert!(!processed.resized);
        assert_eq!(processed.format, ImageFormat::Png);
        assert_eq!((processed.width, processed.height), (800, 600));
    }
}

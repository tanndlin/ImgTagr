use std::io::Cursor;

use bytes::Bytes;
use image::{
    DynamicImage, ImageDecoder, ImageFormat, ImageReader, Rgb, RgbImage, codecs::jpeg::JpegEncoder,
    metadata::Orientation,
};
use img_parts::{ImageEXIF, jpeg::Jpeg, png::Png, webp::WebP};

const THUMBNAIL_SIZE: u32 = 400;

pub struct Processed {
    pub original: Bytes,
    pub format: ImageFormat,
    pub width: u32,
    pub height: u32,
    pub thumbnail: Bytes,
}

#[derive(Debug)]
pub enum ProcessError {
    Unsupported,
    Invalid(String),
    Encode(String),
}

pub fn process(data: Bytes) -> Result<Processed, ProcessError> {
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
    let small = if img.width() > THUMBNAIL_SIZE || img.height() > THUMBNAIL_SIZE {
        img.thumbnail(THUMBNAIL_SIZE, THUMBNAIL_SIZE)
    } else {
        img.clone()
    };

    // JPEG has no alpha, so flatten onto white.
    let rgba = small.to_rgba8();
    let flat = RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let [r, g, b, a] = rgba.get_pixel(x, y).0;
        let blend = |c: u8| ((c as u32 * a as u32 + 255 * (255 - a as u32)) / 255) as u8;
        Rgb([blend(r), blend(g), blend(b)])
    });

    let mut out = Vec::new();
    flat.write_with_encoder(JpegEncoder::new_with_quality(&mut out, 80))
        .map_err(|e| ProcessError::Encode(e.to_string()))?;
    Ok(out.into())
}

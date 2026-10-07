use uuid::Uuid;

use crate::error::ApiError;

/// Parses comma-separated ids, deduplicated so counts can be compared against them.
pub fn parse_ids(csv: &str, kind: &str) -> Result<Vec<Uuid>, ApiError> {
    let mut ids = csv
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| {
            Uuid::parse_str(s).map_err(|_| ApiError::bad_request(format!("invalid {kind} id: {s}")))
        })
        .collect::<Result<Vec<_>, _>>()?;
    ids.sort_unstable();
    ids.dedup();
    Ok(ids)
}

pub fn require_ids(ids: &[Uuid], field: &str) -> Result<(), ApiError> {
    if ids.is_empty() {
        return Err(ApiError::bad_request(format!("{field} must not be empty")));
    }
    Ok(())
}

/// `verb` completes "at most N images can be … at once".
pub fn limit_images(ids: &[Uuid], max: usize, verb: &str) -> Result<(), ApiError> {
    if ids.len() > max {
        return Err(ApiError::bad_request(format!(
            "at most {max} images can be {verb} at once"
        )));
    }
    Ok(())
}

/// Collapses runs of whitespace; `what` names the field in errors, e.g. "tag name".
pub fn normalize_name(raw: &str, what: &str, max_chars: usize) -> Result<String, ApiError> {
    let name = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        return Err(ApiError::bad_request(format!("{what} must not be empty")));
    }
    if name.chars().count() > max_chars {
        return Err(ApiError::bad_request(format!(
            "{what} must be at most {max_chars} characters"
        )));
    }
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_deduplicated() {
        let id = Uuid::nil().to_string();
        let ids = parse_ids(&format!("{id}, ,{id}"), "image").ok();
        assert_eq!(ids.map(|ids| ids.len()), Some(1));
        assert!(parse_ids("nope", "image").is_err());
    }

    #[test]
    fn names_collapse_whitespace() {
        assert_eq!(
            normalize_name("  a \t b ", "tag name", 64).ok().as_deref(),
            Some("a b")
        );
        assert!(normalize_name("   ", "tag name", 64).is_err());
        assert!(normalize_name("abc", "tag name", 2).is_err());
    }
}

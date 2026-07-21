use base64::{engine::general_purpose, Engine as _};
use lofty::config::WriteOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::tag::{Accessor, ItemKey, Tag, TagType};
use serde::Deserialize;
use std::fs::{self, OpenOptions};
use std::path::Path;

mod app_logger;
mod native_audio;
mod window_state;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EmbeddedMetadataUpdate {
    path: String,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    year: Option<u32>,
    lyrics: Option<String>,
    cover_data_url: Option<String>,
}

struct PreparedEmbeddedMetadata {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    year: Option<u32>,
    lyrics: Option<String>,
    cover: Option<(MimeType, Vec<u8>)>,
}

fn clean_text(value: Option<String>) -> Option<String> {
    value.and_then(|text| {
        let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
        (!normalized.is_empty()).then_some(normalized)
    })
}

fn decode_data_url(data_url: &str) -> Result<(MimeType, Vec<u8>), String> {
    let (metadata, encoded) = data_url
        .split_once(',')
        .ok_or_else(|| "封面 data URL 格式无效".to_string())?;

    if !metadata.starts_with("data:") || !metadata.contains(";base64") {
        return Err("封面必须是 base64 data URL".to_string());
    }

    let mime = metadata
        .trim_start_matches("data:")
        .split(';')
        .next()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("image/jpeg");

    let bytes = general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| format!("封面 base64 解码失败: {error}"))?;

    if bytes.is_empty() {
        return Err("封面数据为空".to_string());
    }

    Ok((MimeType::from_str(mime), bytes))
}

fn ensure_primary_tag(tagged_file: &mut lofty::file::TaggedFile) -> Result<&mut Tag, String> {
    let tag_type: TagType = tagged_file.primary_tag_type();
    if !tagged_file.contains_tag_type(tag_type) {
        tagged_file.insert_tag(Tag::new(tag_type));
    }

    tagged_file
        .primary_tag_mut()
        .ok_or_else(|| "当前音频格式不支持写入标签".to_string())
}

fn mime_type_to_string(mime_type: &MimeType) -> String {
    match mime_type {
        MimeType::Png => "image/png".to_string(),
        MimeType::Jpeg => "image/jpeg".to_string(),
        MimeType::Tiff => "image/tiff".to_string(),
        MimeType::Bmp => "image/bmp".to_string(),
        MimeType::Gif => "image/gif".to_string(),
        MimeType::Unknown(value) => value.clone(),
        _ => "image/jpeg".to_string(),
    }
}

fn write_mp3_id3_metadata(
    path: &Path,
    metadata: &PreparedEmbeddedMetadata,
) -> Result<bool, String> {
    let is_mp3 = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("mp3"));
    if !is_mp3 {
        return Ok(false);
    }

    use id3::frame::{Lyrics, Picture as Id3Picture, PictureType as Id3PictureType};
    use id3::{TagLike, Version};

    let mut tag = id3::Tag::read_from_path(path).unwrap_or_else(|_| id3::Tag::new());

    if let Some(value) = metadata.title.clone() {
        tag.set_title(value);
    }
    if let Some(value) = metadata.artist.clone() {
        tag.set_artist(value);
    }
    if let Some(value) = metadata.album.clone() {
        tag.set_album(value);
    }
    if let Some(value) = metadata.year.filter(|year| *year > 0) {
        tag.set_year(value as i32);
    }
    if let Some(value) = metadata.lyrics.clone() {
        tag.remove_all_lyrics();
        tag.add_frame(Lyrics {
            lang: "und".to_string(),
            description: String::new(),
            text: value,
        });
    }
    if let Some((mime_type, bytes)) = metadata.cover.clone() {
        tag.remove_all_pictures();
        tag.add_frame(Id3Picture {
            mime_type: mime_type_to_string(&mime_type),
            picture_type: Id3PictureType::CoverFront,
            description: String::new(),
            data: bytes,
        });
    }

    tag.write_to_path(path, Version::Id3v24)
        .map_err(|error| format!("写入 MP3 ID3 标签失败: {error}"))?;

    Ok(true)
}

fn directory_size(path: &Path) -> Result<u64, String> {
    let metadata = fs::metadata(path).map_err(|error| format!("读取目录信息失败: {error}"))?;
    if metadata.is_file() {
        return Ok(metadata.len());
    }
    if !metadata.is_dir() {
        return Ok(0);
    }

    let mut total = 0_u64;
    let entries = fs::read_dir(path).map_err(|error| format!("读取目录失败: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取目录项失败: {error}"))?;
        total = total.saturating_add(directory_size(&entry.path())?);
    }

    Ok(total)
}

#[tauri::command]
fn get_directory_size(path: String) -> Result<u64, String> {
    let path = path.trim();
    if path.is_empty() {
        return Ok(0);
    }

    let path_ref = Path::new(path);
    if !path_ref.exists() {
        return Ok(0);
    }

    directory_size(path_ref)
}

#[tauri::command]
fn write_embedded_metadata(update: EmbeddedMetadataUpdate) -> Result<bool, String> {
    let path = update.path.trim();
    if path.is_empty() {
        return Ok(false);
    }

    let metadata = PreparedEmbeddedMetadata {
        title: clean_text(update.title),
        artist: clean_text(update.artist),
        album: clean_text(update.album),
        year: update.year,
        lyrics: update
            .lyrics
            .and_then(|value| (!value.trim().is_empty()).then_some(value)),
        cover: match update.cover_data_url.as_deref() {
            Some(value) if !value.trim().is_empty() => Some(decode_data_url(value)?),
            _ => None,
        },
    };

    if metadata.title.is_none()
        && metadata.artist.is_none()
        && metadata.album.is_none()
        && metadata.year.is_none()
        && metadata.lyrics.is_none()
        && metadata.cover.is_none()
    {
        return Ok(false);
    }

    let path_ref = Path::new(path);
    let mut tagged_file =
        lofty::read_from_path(path_ref).map_err(|error| format!("读取音频标签失败: {error}"))?;

    {
        let tag = ensure_primary_tag(&mut tagged_file)?;

        if let Some(value) = metadata.title.clone() {
            tag.set_title(value);
        }
        if let Some(value) = metadata.artist.clone() {
            tag.set_artist(value);
        }
        if let Some(value) = metadata.album.clone() {
            tag.set_album(value);
        }
        if let Some(value) = metadata.year.filter(|year| *year > 0) {
            tag.set_year(value);
        }
        if let Some(value) = metadata.lyrics.clone() {
            tag.insert_text(ItemKey::Lyrics, value);
        }
        if let Some((mime_type, bytes)) = metadata.cover.clone() {
            tag.remove_picture_type(PictureType::CoverFront);
            tag.push_picture(Picture::new_unchecked(
                PictureType::CoverFront,
                Some(mime_type),
                None,
                bytes,
            ));
        }
    }

    let save_result = OpenOptions::new()
        .read(true)
        .write(true)
        .open(path_ref)
        .map_err(|error| format!("打开音频文件失败: {error}"))
        .and_then(|mut file| {
            tagged_file
                .save_to(&mut file, WriteOptions::default())
                .map_err(|error| format!("写入音频标签失败: {error}"))
        });

    if let Err(error) = save_result {
        let did_write_mp3 = write_mp3_id3_metadata(path_ref, &metadata)?;
        if did_write_mp3 {
            return Ok(true);
        }

        if error.contains("No format could be determined from the provided file") {
            return Ok(false);
        }

        return Err(error);
    }

    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            app_logger::append_native_startup_log(app.handle());
            window_state::setup_window_position_memory(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_logger::append_app_log,
            app_logger::get_app_log_directory,
            app_logger::reveal_app_data_directory,
            greet,
            get_directory_size,
            native_audio::native_audio_pause,
            native_audio::native_audio_play,
            native_audio::native_audio_resume,
            native_audio::native_audio_seek,
            native_audio::native_audio_set_volume,
            native_audio::native_audio_status,
            native_audio::native_audio_stop,
            write_embedded_metadata
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

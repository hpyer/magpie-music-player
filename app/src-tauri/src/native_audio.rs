use rodio::{Decoder, OutputStream, Sink, Source};
use serde::Serialize;
use std::fs::File;
use std::io::BufReader;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::OnceLock;
use std::thread;
use std::time::{Duration, Instant};

struct NativeAudioState {
    stream: Option<OutputStream>,
    sink: Option<Sink>,
    path: Option<String>,
    duration: Option<Duration>,
    started_at: Option<Instant>,
    position_at_start: Duration,
    paused_position: Duration,
    paused: bool,
    volume: f32,
}

impl Default for NativeAudioState {
    fn default() -> Self {
        Self {
            stream: None,
            sink: None,
            path: None,
            duration: None,
            started_at: None,
            position_at_start: Duration::ZERO,
            paused_position: Duration::ZERO,
            paused: false,
            volume: 0.5,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioStatus {
    is_playing: bool,
    current_time: f64,
    duration: f64,
    ended: bool,
}

enum AudioCommand {
    Play {
        path: String,
        volume: f32,
        start_seconds: f64,
        reply: Sender<Result<(), String>>,
    },
    Pause {
        reply: Sender<Result<(), String>>,
    },
    Resume {
        reply: Sender<Result<(), String>>,
    },
    Stop {
        forget_path: bool,
        reply: Sender<Result<(), String>>,
    },
    Seek {
        seconds: f64,
        reply: Sender<Result<(), String>>,
    },
    SetVolume {
        volume: f32,
        reply: Sender<Result<(), String>>,
    },
    Status {
        reply: Sender<Result<NativeAudioStatus, String>>,
    },
}

static AUDIO_COMMANDS: OnceLock<Sender<AudioCommand>> = OnceLock::new();

fn audio_commands() -> Sender<AudioCommand> {
    AUDIO_COMMANDS
        .get_or_init(|| {
            let (sender, receiver) = mpsc::channel();
            thread::spawn(move || run_audio_thread(receiver));
            sender
        })
        .clone()
}

fn run_audio_thread(receiver: Receiver<AudioCommand>) {
    let mut state = NativeAudioState::default();

    for command in receiver {
        match command {
            AudioCommand::Play {
                path,
                volume,
                start_seconds,
                reply,
            } => {
                let _ = reply.send(play_path(&mut state, path, volume, start_seconds));
            }
            AudioCommand::Pause { reply } => {
                state.paused_position = position(&state);
                state.paused = true;
                if let Some(sink) = &state.sink {
                    sink.pause();
                }
                let _ = reply.send(Ok(()));
            }
            AudioCommand::Resume { reply } => {
                if let Some(sink) = &state.sink {
                    sink.play();
                    state.position_at_start = state.paused_position;
                    state.started_at = Some(Instant::now());
                    state.paused = false;
                }
                let _ = reply.send(Ok(()));
            }
            AudioCommand::Stop { forget_path, reply } => {
                stop_current(&mut state);
                if forget_path {
                    state.path = None;
                }
                let _ = reply.send(Ok(()));
            }
            AudioCommand::Seek { seconds, reply } => {
                let volume = state.volume;
                let result = state
                    .path
                    .clone()
                    .ok_or_else(|| "没有正在播放的本地音频。".to_string())
                    .and_then(|path| play_path(&mut state, path, volume, seconds));
                let _ = reply.send(result);
            }
            AudioCommand::SetVolume { volume, reply } => {
                state.volume = volume.clamp(0.0, 1.0);
                if let Some(sink) = &state.sink {
                    sink.set_volume(state.volume);
                }
                let _ = reply.send(Ok(()));
            }
            AudioCommand::Status { reply } => {
                let _ = reply.send(Ok(status_from_state(&state)));
            }
        }
    }
}

fn send_unit(
    command: impl FnOnce(Sender<Result<(), String>>) -> AudioCommand,
) -> Result<(), String> {
    let (reply, response) = mpsc::channel();
    audio_commands()
        .send(command(reply))
        .map_err(|error| format!("发送音频指令失败: {error}"))?;
    response
        .recv()
        .map_err(|error| format!("接收音频指令结果失败: {error}"))?
}

fn position(state: &NativeAudioState) -> Duration {
    if state.sink.as_ref().is_some_and(Sink::empty) {
        return state.duration.unwrap_or(state.paused_position);
    }

    if state.paused {
        return state.paused_position;
    }

    let elapsed = state
        .started_at
        .map(|started_at| started_at.elapsed())
        .unwrap_or_default();
    let current = state.position_at_start.saturating_add(elapsed);
    state
        .duration
        .map(|duration| current.min(duration))
        .unwrap_or(current)
}

fn status_from_state(state: &NativeAudioState) -> NativeAudioStatus {
    let current = position(state);
    let ended = state.sink.as_ref().is_some_and(Sink::empty);
    NativeAudioStatus {
        is_playing: state.sink.is_some() && !state.paused && !ended,
        current_time: current.as_secs_f64(),
        duration: state.duration.unwrap_or_default().as_secs_f64(),
        ended,
    }
}

fn stop_current(state: &mut NativeAudioState) {
    if let Some(sink) = state.sink.take() {
        sink.stop();
    }
    state.stream = None;
    state.started_at = None;
    state.position_at_start = Duration::ZERO;
    state.paused_position = Duration::ZERO;
    state.duration = None;
    state.paused = false;
}

fn open_decoder(path: &str) -> Result<Decoder<BufReader<File>>, String> {
    let file = File::open(path).map_err(|error| format!("打开音频文件失败: {error}"))?;
    Decoder::new(BufReader::new(file)).map_err(|error| format!("解码音频文件失败: {error}"))
}

fn play_path(
    state: &mut NativeAudioState,
    path: String,
    volume: f32,
    start_seconds: f64,
) -> Result<(), String> {
    stop_current(state);

    let start = Duration::from_secs_f64(start_seconds.max(0.0));
    let decoder = open_decoder(&path)?;
    let duration = decoder.total_duration();
    let source = decoder.skip_duration(start);
    let (stream, stream_handle) =
        OutputStream::try_default().map_err(|error| format!("初始化音频输出失败: {error}"))?;
    let sink =
        Sink::try_new(&stream_handle).map_err(|error| format!("创建音频输出失败: {error}"))?;
    sink.set_volume(volume.clamp(0.0, 1.0));
    sink.append(source);
    sink.play();

    state.stream = Some(stream);
    state.sink = Some(sink);
    state.path = Some(path);
    state.duration = duration;
    state.started_at = Some(Instant::now());
    state.position_at_start = start;
    state.paused_position = start;
    state.paused = false;
    state.volume = volume.clamp(0.0, 1.0);

    Ok(())
}

#[tauri::command]
pub fn native_audio_play(path: String, volume: f32, start_seconds: f64) -> Result<(), String> {
    send_unit(|reply| AudioCommand::Play {
        path,
        volume,
        start_seconds,
        reply,
    })
}

#[tauri::command]
pub fn native_audio_pause() -> Result<(), String> {
    send_unit(|reply| AudioCommand::Pause { reply })
}

#[tauri::command]
pub fn native_audio_resume() -> Result<(), String> {
    send_unit(|reply| AudioCommand::Resume { reply })
}

#[tauri::command]
pub fn native_audio_stop() -> Result<(), String> {
    send_unit(|reply| AudioCommand::Stop {
        forget_path: true,
        reply,
    })
}

#[tauri::command]
pub fn native_audio_seek(seconds: f64) -> Result<(), String> {
    send_unit(|reply| AudioCommand::Seek { seconds, reply })
}

#[tauri::command]
pub fn native_audio_set_volume(volume: f32) -> Result<(), String> {
    send_unit(|reply| AudioCommand::SetVolume { volume, reply })
}

#[tauri::command]
pub fn native_audio_status() -> Result<NativeAudioStatus, String> {
    let (reply, response) = mpsc::channel();
    audio_commands()
        .send(AudioCommand::Status { reply })
        .map_err(|error| format!("发送音频状态指令失败: {error}"))?;
    response
        .recv()
        .map_err(|error| format!("接收音频状态失败: {error}"))?
}

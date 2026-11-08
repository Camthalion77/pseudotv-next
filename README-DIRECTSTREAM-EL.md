# PseudoTV Next: Direct Stream edition

**Only remuxing**: Video and audio are carried with `-c:v copy -c:a copy`, without video processing, subtitles burn-in, GPU, resizing, changing frame rate or transcoding.

## Changes
- `src/ffmpeg.js`: per-programme FFmpeg stream-copy into MPEG-TS, error propagation, proper child shutdown, source credentials hidden in errors.
- `src/mpegts.js`: transport continuity counter updates per PID and MPEG-TS PCR/PTS/DTS translation for joined independent FFmpeg sessions. Elementary video/audio bytes remain unchanged.
- `src/video.js`: HTTP `video/mp2t`, backpressure, clean disconnect handling, deterministic programme progression, retained `/video?channel=N` URL for TVHeadend and HDHomeRun.
- `src/helperFuncs.js`: scheduler validation and commercial compatibility; avoids splitting one movie unnecessarily into four FFmpeg sessions.
- `.github/workflows/check.yml`: node syntax and integration tests.
- `tests/`: synthetic MPEG-TS segment and schedule verification.

## Limits / deployment notes
- Compatible *with* MPEG-TS transport does not guarantee that a TVHeadend client supports every video/audio codec. An unsupported codec yields an error; never a transcode.
- Video cannot have an on-picture logo or burned subtitles in copy mode. The original channel logo in playlists/EPG is untouched. Subtitle streams are not included in the stream-copy output.
- Mixed codec or resolution changes between consecutive shows can still trigger decoder reinitialization in downstream software. For maximum TVHeadend reliability use consistent source codecs in each channel.
- FFmpeg is launched once per active TVHeadend HTTP connection; a shared channel worker/fan-out is a separate scalability feature and is not claimed here.
- Channel data and Plex auth are not modified. The existing HTML FFmpeg settings may still show old transcoding fields, but this stream engine ignores them.
- The /setup placeholder returns HTTP 503 rather than creating newly encoded content. The old HDHomeRun endpoints and URLs remain in place.
- The project is not tested against the user's actual ZimaOS, TVHeadend or Plex. Test it as a second Docker stack with separate port and settings volume before replacing anything in production.

## Interface
- The FFMPEG settings screen is simplified: FFmpeg path + diagnostics only.
- The original channel-editor overlay control can still exist in legacy HTML, but in strict-copy mode it is ignored and no burn-in is ever done.
- Existing settings in diskdb need no migration; legacy encoder fields are ignored by this engine.

## Docker trial
- `Dockerfile` updates the runtime to Node 22 and uses FFmpeg from Debian Bookworm.
- `compose.direct-stream.example.yml` is a separate test configuration on host port 8098 with SSDP discovery disabled by default to avoid clashing with production HDHomeRun.
- The current repository's old Node dependencies are retained to minimise migration risk. Container build and existing Plex sign-in must be validated before production cutover.
- Use a **new** volume for `/data`. Never mount the production PseudoTV database in the test instance.

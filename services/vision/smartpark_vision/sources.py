"""Camera source validation. Local files are restricted to the configured media folder."""
from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse


def resolve_source(reference: str, media_root: Path, allow_rtsp: bool):
    value = str(reference or '').strip()
    if not value:
        raise ValueError('No video source is configured for this camera.')
    if value.isdecimal():
        index = int(value)
        if index > 31:
            raise ValueError('Webcam index must be between 0 and 31.')
        return index, None
    parsed = urlparse(value)
    if parsed.scheme.lower() in {'rtsp', 'rtsps'}:
        if not allow_rtsp:
            raise ValueError('RTSP streams are disabled. Set VISION_ALLOW_RTSP=true only on a trusted network.')
        if not parsed.hostname:
            raise ValueError('The RTSP stream URL must include a hostname.')
        return value, None
    if parsed.scheme or value.startswith(('\\\\', '//')):
        raise ValueError('Only a webcam index, a local media filename, or an explicitly enabled RTSP URL is supported.')

    root = media_root.resolve()
    candidate = (root / value).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise ValueError('Local video files must be inside VISION_MEDIA_ROOT.') from exc
    if not candidate.is_file():
        raise ValueError(f"Video file '{candidate.name}' was not found inside the configured media folder.")
    return str(candidate), candidate


def is_file_source(source_file: Path | None) -> bool:
    return source_file is not None

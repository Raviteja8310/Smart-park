FROM python:3.11-slim

ARG INSTALL_YOLO=true
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VISION_HOST=0.0.0.0 \
    VISION_PORT=8000 \
    VISION_MEDIA_ROOT=/data/videos

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg libglib2.0-0 libgl1 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt requirements-yolo.txt ./
RUN if [ "$INSTALL_YOLO" = "true" ]; then \
      pip install --no-cache-dir -r requirements-yolo.txt; \
    else \
      pip install --no-cache-dir -r requirements.txt; \
    fi
COPY smartpark_vision ./smartpark_vision
RUN mkdir -p /data/videos
VOLUME ["/data/videos"]
EXPOSE 8000
CMD ["uvicorn", "smartpark_vision.main:app", "--host", "0.0.0.0", "--port", "8000"]

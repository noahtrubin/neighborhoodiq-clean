FROM python:3.12-slim

# Flush print() logs immediately to Cloud Logging.
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install deps first for layer caching. pandas/numpy/scikit-learn ship cp312
# manylinux wheels, so no compiler/build tools are needed on slim.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY model.py download.py firestore_writer.py main.py ./

# Run as non-root.
RUN useradd --create-home --uid 1001 appuser
USER appuser

# Cloud Run Jobs run this once per execution (no HTTP server).
CMD ["python", "main.py"]

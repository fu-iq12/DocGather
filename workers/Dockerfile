# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Stage 2: Runtime with Python + binaries
FROM node:22-alpine

# System dependencies for document processing
# Alpine uses apk. we install:
# - python3 & pip for python support
# - poppler-utils for pdf2image
# - libreoffice for doc conversions
# - imagemagick (version 7+ on alpine)
# - legacy dependencies for building python extensions if wheels are missing (build-base, etc)
RUN apk add --no-cache \
    python3 py3-pip \
    poppler-utils \
    libreoffice \
    imagemagick \
    # Tesseract OCR for cheap text-presence detection (image-prefilter)
    tesseract-ocr \
    tesseract-ocr-data-eng \
    tesseract-ocr-data-fra \
    # MuPDF for XPS to PDF conversion (mutool)
    mupdf-tools \
    # Build dependencies for some python packages
    build-base python3-dev \
    jpeg-dev zlib-dev libpng-dev \
    # Fonts are often needed for libreoffice/rendering
    ttf-dejavu

# Python virtual environment
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy only requirements.txt first to leverage Docker cache
COPY processors/python/requirements.txt /tmp/requirements.txt

# Python packages for document processing
RUN pip install --no-cache-dir -r /tmp/requirements.txt

WORKDIR /app

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy source and config
COPY package*.json ./
COPY tsconfig.json ./
COPY src ./src
COPY processors ./processors

# Build TypeScript
RUN npm run build

EXPOSE 8080
CMD ["node", "dist/index.js"]


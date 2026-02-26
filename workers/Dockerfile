# Phase 1: TypeScript compilation
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Phase 2: Runtime environment with Python and unified binaries
FROM node:22-alpine

# System dependencies driving document processing tasks.
# Includes Python (scripts), Poppler (pdf rasterization), LibreOffice (conversion),
# ImageMagick (scaling), Tesseract OCR (heuristics), and MuPDF (XPS extraction).
# @see architecture/documents-checklist.md - "Dependency Baseline"
RUN apk add --no-cache \
    python3 py3-pip \
    poppler-utils \
    libreoffice \
    imagemagick \
    # Lightweight OCR for image-prefilter heuristics
    tesseract-ocr \
    tesseract-ocr-data-eng \
    tesseract-ocr-data-fra \
    # XPS to PDF conversion via mutool
    mupdf-tools \
    # Native extension build dependencies
    build-base python3-dev \
    jpeg-dev zlib-dev libpng-dev \
    # Core fonts for libreoffice format conversions
    ttf-dejavu

# Isolate Python environment for processor scripts
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Cache Python dependencies layer
COPY processors/python/requirements.txt /tmp/requirements.txt

# Install Python processor dependencies
RUN pip install --no-cache-dir -r /tmp/requirements.txt

WORKDIR /app

# Inject compiled Node modules
COPY --from=builder /app/node_modules ./node_modules

# Inject worker source code and configurations
COPY package*.json ./
COPY tsconfig.json ./
COPY src ./src
COPY processors ./processors

# Compile TypeScript workers
RUN npm run build

EXPOSE 8080
CMD ["node", "dist/index.js"]


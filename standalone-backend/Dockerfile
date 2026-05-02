# For Vast.ai with NVIDIA GPUs, we MUST use an NVIDIA CUDA base image
# to gain access to the NVENC hardware encoders.
FROM nvidia/cuda:12.2.2-base-ubuntu22.04

# Set non-interactive mode for apt-get
ENV DEBIAN_FRONTEND=noninteractive

# Install Node.js, Chrome dependencies, and FFmpeg (with NVENC support from standard ubuntu repos)
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    libnspr4 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libpango-1.0-0 \
    libcairo2 \
    libatspi2.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxext6 \
    libxfixes3 \
    libdrm2 \
    ca-certificates \
    fonts-liberation \
    wget \
    ffmpeg \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application
COPY . .

# Start the server queue
CMD ["npm", "start"]

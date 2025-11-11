FROM node:22-alpine

# Install build dependencies for node-canvas, ffmpeg, and other native modules
RUN apk add --no-cache \
    git \
    python3 \
    make \
    g++ \
    tzdata \
    haveged \
    pkgconfig \
    pixman-dev \
    cairo-dev \
    pango-dev \
    jpeg-dev \
    giflib-dev \
    librsvg-dev \
    ffmpeg

# Set timezone
ENV TZ=Asia/Karachi
ENV NODE_ENV=production

# Create app directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .


EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["sh", "-c", "haveged -F & (node koyeb.js &) & exec node index.js"]

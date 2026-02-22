FROM node:20-alpine

WORKDIR /app

# Install deps first (layer cache)
COPY package*.json ./
RUN npm ci

# Prisma schema
COPY prisma ./prisma
RUN npx prisma generate

# Source
COPY . .

# Data dir for SQLite volume mount
RUN mkdir -p /data

EXPOSE 3001

CMD ["sh", "-c", "npx prisma db push --skip-generate && npm run dev"]

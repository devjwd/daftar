# Production Dockerfile for Railway Backend
FROM node:20-alpine

WORKDIR /app

# Copy root package files
COPY package*.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Copy server code
COPY server/ ./server/

# Ensure host is 0.0.0.0 for external access
ENV HOST=0.0.0.0
# Ensure PORT matches Railway networking (default 3001)
ENV PORT=3001
ENV NODE_ENV=production

EXPOSE 3001

# Start the Express server
CMD ["npm", "start"]

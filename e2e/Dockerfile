FROM mcr.microsoft.com/playwright:v1.50.0-jammy

WORKDIR /app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the e2e folder
COPY . .

# Default command: run playwright tests
CMD ["npx", "playwright", "test", "--project=docker"]

FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./

RUN npm ci --only=production

# Bundle app source
COPY . .

# Keep the daily-report delivery marker outside the application image. In Dokploy,
# mount /app/data as a persistent volume so a restart cannot resend or skip a report.
VOLUME ["/app/data"]

# Expose port 3000 for the Express server
EXPOSE 3000

# Start command
CMD [ "npm", "start" ]

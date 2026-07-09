FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./

RUN npm ci --only=production

# Bundle app source
COPY . .

# Expose port 3000 for the Express server
EXPOSE 3000

# Start command
CMD [ "npm", "start" ]

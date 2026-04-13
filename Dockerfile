FROM node:20-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY . .

RUN npm install --omit=dev

RUN mkdir -p /data && chown node:node /data

USER node

CMD ["node", "src/bot.js"]

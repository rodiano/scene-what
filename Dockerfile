FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY public ./public
COPY config ./config
COPY media ./media
ENV PORT=3000 MAX_PLAYERS=6
EXPOSE 3000
USER node
CMD ["node", "server.js"]

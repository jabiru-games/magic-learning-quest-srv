FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.js lobby.js ./
COPY domain ./domain
ENV PORT=8787
EXPOSE 8787
USER node
CMD ["node", "index.js"]

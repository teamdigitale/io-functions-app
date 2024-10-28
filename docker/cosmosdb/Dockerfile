FROM node:18.13.0@sha256:d871edd5b68105ebcbfcde3fe8c79d24cbdbb30430d9bd6251c57c56c7bd7646

WORKDIR /opt/cosmosdb

RUN npm install -g @zeit/cosmosdb-server

CMD ["sh", "-c", "cosmosdb-server -p 3000"]

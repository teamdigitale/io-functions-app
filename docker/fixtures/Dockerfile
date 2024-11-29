FROM node:18.13.0-alpine@sha256:fda98168118e5a8f4269efca4101ee51dd5c75c0fe56d8eb6fad80455c2f5827

WORKDIR /opt/cosmosdb

RUN apk add git
RUN npm install -g ts-node typescript && \
    npm install documentdb @types/documentdb @pagopa/io-functions-commons \
    io-ts@2.2.20 fp-ts@2.16.0 @pagopa/ts-commons

COPY ./utils /utils
COPY ./node_modules /node_modules
COPY ./tsconfig.json /tsconfig.json
COPY docker/fixtures/index.ts /opt/cosmosdb

CMD ["sh", "-c", "ts-node index"]

FROM golang:1.26.5-bookworm AS engine
ENV GOMAXPROCS=2 GOMEMLIMIT=800MiB
RUN git clone --depth 1 --branch v0.43.0 https://github.com/ipfs/kubo.git /src/kubo && \
    git clone https://github.com/ipfs/go-ds-s3.git /src/go-ds-s3 && \
    git -C /src/go-ds-s3 checkout e4823540f59b71ce7969213faed4608c237a7296
# Railway's new buckets require virtual-hosted S3 URLs. Upstream forces path style.
RUN sed -i 's/awsConfig.WithS3ForcePathStyle(true)/awsConfig.WithS3ForcePathStyle(false)/' /src/go-ds-s3/s3.go
COPY transport.go /src/go-ds-s3/dyoor_transport.go
RUN sed -i 's/awsConfig := aws.NewConfig()/awsConfig := aws.NewConfig().WithHTTPClient(dyoorS3HTTPClient())/' /src/go-ds-s3/s3.go
WORKDIR /src/kubo
COPY preload-s3.go /src/kubo/plugin/loader/preload-s3.go
RUN go mod edit -replace github.com/ipfs/go-ds-s3=/src/go-ds-s3 && \
    go mod edit -require github.com/ipfs/go-ds-s3@v0.0.0 && go mod tidy
RUN go build -trimpath -o /usr/local/bin/ipfs ./cmd/ipfs
FROM caddy:2-alpine AS proxy
FROM debian:bookworm-slim
USER root
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates tini jq && rm -rf /var/lib/apt/lists/*
COPY --from=engine /usr/local/bin/ipfs /usr/local/bin/ipfs
COPY --from=proxy /usr/bin/caddy /usr/local/bin/caddy
COPY start.sh /opt/dyoor/start.sh
COPY Caddyfile /opt/dyoor/Caddyfile
COPY mirror-file.sh /opt/dyoor/mirror-file.sh
RUN ipfs version && caddy validate --config /opt/dyoor/Caddyfile --adapter caddyfile
ENV IPFS_PATH=/data/ipfs/s3-node IPFS_TELEMETRY=off GOMAXPROCS=2 GOMEMLIMIT=600MiB PORT=8080
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--", "/bin/sh", "/opt/dyoor/start.sh"]

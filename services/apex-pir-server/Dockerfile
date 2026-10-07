FROM swift:6.1-jammy
WORKDIR /build
RUN apt-get update && apt-get install -y git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/apple/pir-service-example.git /build/pir-service-example
RUN git clone --depth 1 --branch release/1.1 https://github.com/apple/swift-homomorphic-encryption.git /build/swift-homomorphic-encryption
WORKDIR /build/swift-homomorphic-encryption
RUN swift build -c release --product PIRProcessDatabase
WORKDIR /build/pir-service-example
RUN swift build -c release --product PIRService
COPY input.txtpb /data/input.txtpb
COPY url-config.json /data/url-config.json
COPY service-config.json /data/service-config.json
RUN /build/swift-homomorphic-encryption/.build/release/PIRProcessDatabase /data/url-config.json
EXPOSE 8080
CMD ["/build/pir-service-example/.build/release/PIRService","--hostname","0.0.0.0","--port","8080","/data/service-config.json"]

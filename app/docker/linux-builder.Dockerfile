ARG NODE_IMAGE=node:22-bookworm
FROM ${NODE_IMAGE}

ARG APT_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian
ARG DEBIAN_SECURITY_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian-security
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG RUSTUP_DIST_SERVER=https://mirrors.tuna.tsinghua.edu.cn/rustup
ARG RUSTUP_UPDATE_ROOT=https://mirrors.tuna.tsinghua.edu.cn/rustup/rustup
ARG CARGO_REGISTRY=sparse+https://rsproxy.cn/index/

ENV DEBIAN_FRONTEND=noninteractive
ENV CARGO_HOME=/usr/local/cargo
ENV RUSTUP_HOME=/usr/local/rustup
ENV RUSTUP_DIST_SERVER=${RUSTUP_DIST_SERVER}
ENV RUSTUP_UPDATE_ROOT=${RUSTUP_UPDATE_ROOT}
ENV npm_config_registry=${NPM_REGISTRY}
ENV COREPACK_NPM_REGISTRY=${NPM_REGISTRY}
ENV PATH=/usr/local/cargo/bin:$PATH

RUN if [ -n "$APT_MIRROR" ]; then \
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      sed -i \
        -e "s#http://deb.debian.org/debian-security#$DEBIAN_SECURITY_MIRROR#g" \
        -e "s#http://deb.debian.org/debian#$APT_MIRROR#g" \
        /etc/apt/sources.list.d/debian.sources; \
    elif [ -f /etc/apt/sources.list ]; then \
      sed -i \
        -e "s#http://deb.debian.org/debian-security#$DEBIAN_SECURITY_MIRROR#g" \
        -e "s#http://deb.debian.org/debian#$APT_MIRROR#g" \
        /etc/apt/sources.list; \
    fi; \
  fi

RUN apt-get update && apt-get install -y --no-install-recommends \
  bash \
  build-essential \
  ca-certificates \
  curl \
  file \
  libayatana-appindicator3-dev \
  libasound2-dev \
  libfuse2 \
  librsvg2-dev \
  libssl-dev \
  libwebkit2gtk-4.1-dev \
  libxdo-dev \
  patchelf \
  pkg-config \
  rpm \
  tar \
  wget \
  xdg-utils \
  xz-utils \
  && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
  | sh -s -- -y --profile minimal \
  && chmod -R a+w "$CARGO_HOME" "$RUSTUP_HOME"

RUN mkdir -p "$CARGO_HOME" \
  && { \
    printf '[registries.crates-io]\n'; \
    printf 'protocol = "sparse"\n\n'; \
    if [ -n "$CARGO_REGISTRY" ]; then \
      printf '[source.crates-io]\n'; \
      printf 'replace-with = "magpie-mirror"\n\n'; \
      printf '[source.magpie-mirror]\n'; \
      printf 'registry = "%s"\n' "$CARGO_REGISTRY"; \
    fi; \
  } > "$CARGO_HOME/config.toml"

RUN corepack enable \
  && corepack prepare pnpm@10.33.4 --activate \
  && pnpm config set registry "$NPM_REGISTRY"

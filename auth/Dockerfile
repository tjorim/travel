FROM golang:1.24-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /travel-auth .

FROM gcr.io/distroless/static-debian12

COPY --from=build /travel-auth /travel-auth
USER 0:0
EXPOSE 8080
ENTRYPOINT ["/travel-auth"]

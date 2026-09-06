package s3ds

import (
	"net/http"
	"time"
)

// Share and bound backend connections across all block reads and writes.
// The default two idle connections per host cause connection churn during a
// collection import, while an unbounded active pool can exhaust egress ports.
func dyoorS3HTTPClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConns = 64
	transport.MaxIdleConnsPerHost = 32
	transport.MaxConnsPerHost = 64
	transport.IdleConnTimeout = 90 * time.Second
	transport.ResponseHeaderTimeout = 30 * time.Second
	return &http.Client{Transport: transport, Timeout: 60 * time.Second}
}

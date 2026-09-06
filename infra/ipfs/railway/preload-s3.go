package loader

import s3plugin "github.com/ipfs/go-ds-s3/plugin"

func init() {
	Preload(s3plugin.Plugins...)
}

#!/bin/sh
set -eu

# Serve DYOOR-pinned content only, while retaining normal DHT announcements so
# other IPFS peers and gateways can find the collection.
ipfs config --json Gateway.NoFetch true
ipfs config --json Datastore.StorageMax '"80GB"'
ipfs config --json Datastore.GCPeriod '"12h"'

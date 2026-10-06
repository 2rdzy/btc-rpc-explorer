### Setting up an explorer on Ubuntu 20.04 (replace explorer.example.com with your domain)

	# update and install packages
	apt update
	apt upgrade
	apt install docker.io
	
	# get source, npm install
	git clone https://github.com/2rdzy/btc-rpc-explorer.git
	cd btc-rpc-explorer
	
	# build docker image
	docker build -t btc-rpc-explorer .

	# run docker image: detached mode, from the "btc-rpc-explorer" image made above
	#  - --env-file: your settings (see .env-sample); they are not part of the image
	#  - -v ...:ro: the node's cookie file, if you log in with it (use the path that BTCEXP_BITCOIND_COOKIE names)
	#  - -v explorer-cache: keeps the explorer's cache between runs
	#  - --network host: the explorer then reaches a node on this machine as 127.0.0.1 (with -p 127.0.0.1:3002:3002
	#    instead, it listens on port 3002 of this machine only, and the node has to be reachable from the container)
	docker run -d --name btc-rpc-explorer --restart unless-stopped \
		--network host --env-file /path/to/.env \
		-v /path/to/.cookie:/path/to/.cookie:ro \
		-v explorer-cache:/workspace/cache \
		btc-rpc-explorer

The container runs as the unprivileged user `node` (user id 1000), so the cookie file has to be readable by it. The image holds no settings or credentials: do not put them in the Dockerfile or build them in. The build leaves `.env` and the caches out of the image (see `.dockerignore`).

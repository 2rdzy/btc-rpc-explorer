### Setting up an explorer on Ubuntu 20.04 (replace explorer.example.com with your domain)

Update and install packages

    apt update
    apt upgrade
    apt install git nginx gcc g++ make python3-certbot-nginx
    
Install NVM from https://github.com/nvm-sh/nvm

    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    nvm ls-remote
    
    # install latest node from output of ls-remote above, e.g.:
    nvm install 22.11.0 
    
    npm install -g pm2
    
Misc setup

    # add user for btc-related stuff
    adduser bitcoin # leave everything blank if you want
    
    # gen self-signed cert
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout /etc/ssl/private/selfsigned.key -out /etc/ssl/certs/selfsigned.crt
    
    # get nginx config
    wget https://raw.githubusercontent.com/2rdzy/btc-rpc-explorer/master/docs/explorer.example.com.conf
    mv explorer.example.com.conf /etc/nginx/sites-available/explorer.example.com

Get source, install and build

    cd /home/bitcoin
    git clone https://github.com/2rdzy/btc-rpc-explorer.git
    cd /home/bitcoin/btc-rpc-explorer
    npm ci
    npm run build
    
    # startup via pm2 (the built code is in dist/)
    pm2 start dist/bin/www.js --name "btc" --node-args="--enable-source-maps"
    
    # get letsencrypt cert
    certbot --nginx -d explorer.example.com
    
Tor setup

    apt install tor
    
Edit /etc/tor/torrc

1. Uncomment `ControlPort 9051`
2. Uncomment `CookieAuthentication 1`
3. If applicable, add Torv3 Hidden service credentials to `/var/lib/tor/btcexp...onion`
    * chmod 700 for directory, owned by the same "tor" user as other files in that dir
    * chmod 600 for the files in the "btcexp...onion" dir)
5. Add `HiddenServiceDir /var/lib/tor/btcexp...onion/`
6. Add `HiddenServicePort 80 127.0.0.1:3000`


Tor startup

    service tor start
    
    # verify tor startup
    ps -ef | grep tor
    
    # verify tor listening on 9050 (proxy) and 9051 (control port)
    netstat -nlp | grep 905
    

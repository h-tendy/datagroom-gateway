# Use Debian 11 as the base image
FROM debian:11

#Install mongodb community edition
RUN apt-get update && \
    apt-get install -y curl gnupg && \
    curl -fsSL https://pgp.mongodb.com/server-7.0.asc | gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor && \
    echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] http://repo.mongodb.org/apt/debian bullseye/mongodb-org/7.0 main" | tee /etc/apt/sources.list.d/mongodb-org-7.0.list && \
    apt-get update && \
    apt-get install -y mongodb-org && \
    apt-get install -y procps

# Install prerequisites and MongoDB
RUN curl -fsSL https://deb.nodesource.com/setup_12.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g npm@7.5.2

# Create a directory for your Node.js application
WORKDIR /app

# Copy your gateway code and UI code to the app directory
COPY datagroom-ui/ /app/datagroom-ui/
COPY datagroom-gateway/ /app/datagroom-gateway/

# Set working dir as UI and build the UI
WORKDIR /app/datagroom-ui
RUN npm run build

# Expose ports if necessary
EXPOSE 8887/tcp
EXPOSE 8887/udp
EXPOSE 443/tcp
EXPOSE 443/udp

# Set working dir as Gateway and install packages
WORKDIR /app/datagroom-gateway
RUN npm install

RUN chmod +x /app/datagroom-gateway/entryPoint.sh

# Specify the command to run your Node.js application
#CMD ["bash"]
#CMD ["node", "server.js", "disableAD=true"]

# Set the entrypoint to shell script
ENTRYPOINT ["/app/datagroom-gateway/entryPoint.sh"]

# Keycloak image with the Nova realm baked in.
#
# We COPY the realm at build time instead of bind-mounting it because this repo
# lives on a Google Drive virtual filesystem, where Docker Desktop cannot
# reliably resolve a single-file bind mount and silently substitutes an empty
# directory — which makes realm import fail and every /realms/nova URL 404.
# Copying through the build context avoids that class of problem entirely.
FROM quay.io/keycloak/keycloak:26.6

COPY nova-realm.dev.json /opt/keycloak/data/import/nova-realm.dev.json

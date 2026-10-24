"""Administrator-authorized CONNECT routing, with official-host verified TLS.

The proxy is trusted to honor CONNECT. We record the requested global address;
we cannot independently observe or certify the proxy's ultimate network peer.
No proxy env discovery, gateway rewrite, redirects, retries or credential headers
are used for CONNECT. Direct legacy profiles remain a separate transport.
"""
from dataclasses import dataclass, field
import http.client
import socket
import ssl
import time
from urllib.parse import urlsplit

from axis_evo.hashing import canonical_json_bytes
from axis_evo.planning_adapter import OpenAICompatiblePlanningAdapter, PlanningTransportError, _strict_json
from .runtime_config import ProviderRoute


class _ProxyTLSConnection(http.client.HTTPSConnection):
    def __init__(self, route, timeout):
        endpoint = urlsplit(route.endpoint)
        super().__init__(endpoint.hostname, 443, timeout=timeout, context=ssl.create_default_context())
        self.route = route
        self.set_tunnel(route.address, 443)

    def connect(self):
        if time.time() >= self.route.expires_at:
            raise PlanningTransportError('endpoint_policy')
        proxy = urlsplit(self.route.proxy)
        try:
            self.sock = socket.create_connection(('127.0.0.1', proxy.port), timeout=self.timeout)
            self._tunnel()
            # The CONNECT target is an IP, but the authenticated TLS identity
            # and HTTP Host must remain the originally authorized Provider.
            self.sock = self._context.wrap_socket(self.sock, server_hostname=self.host)
        except BaseException:
            self.close()
            raise

    def putrequest(self, method, url, skip_host=False, skip_accept_encoding=False):
        # http.client otherwise derives Host from its tunnel target (the IP).
        super().putrequest(method, url, skip_host=True, skip_accept_encoding=skip_accept_encoding)
        if not skip_host:
            self.putheader('Host', self.host)


@dataclass(frozen=True)
class RoutedPlanningAdapter(OpenAICompatiblePlanningAdapter):
    route_json: str = field(default='', repr=False)

    def __post_init__(self):
        super().__post_init__()
        route = ProviderRoute.from_dict(_strict_json(self.route_json, 2048))
        if route.endpoint != self.endpoint:
            raise ValueError('Provider route cannot change endpoint identity')
        object.__setattr__(self, 'route_json', canonical_json_bytes(route.to_dict()).decode('utf-8'))

    @property
    def network_route(self):
        return _strict_json(self.route_json, 2048)

    def _connection(self, parsed):
        route = ProviderRoute.from_dict(self.network_route)
        if time.time() >= route.expires_at:
            raise PlanningTransportError('endpoint_policy')
        return _ProxyTLSConnection(route, self.timeout_seconds)

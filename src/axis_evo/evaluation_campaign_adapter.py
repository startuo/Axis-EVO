"""Local, nonsecret transport configuration binding; no provider authenticity claim."""
from dataclasses import dataclass, field
import ipaddress
from math import isfinite
from urllib.parse import urlsplit

from .hashing import canonical_json_bytes
from .planning_adapter import _strict_json
from .skill_evolution_storage import _keys, _text, snapshot


def validate_transport(value):
    value = snapshot(value)
    if value.get('kind') == 'injected-test':
        _keys(value, ('kind', 'config_id'))
        _text(value['config_id'], 256)
    else:
        route_keys = ('network_route',) if 'network_route' in value else ()
        _keys(value, ('kind', 'adapter_type', 'endpoint', 'timeout_seconds') + route_keys)
        if value['kind'] != 'configured-network':
            raise ValueError('Unsupported campaign transport projection')
        _text(value['adapter_type'], 256)
        _text(value['endpoint'], 2048)
        url = urlsplit(value['endpoint'])
        if (url.username or url.password or url.query or url.fragment or not url.hostname
                or url.scheme not in ('https', 'http')
                or url.scheme == 'http' and url.hostname != '127.0.0.1'):
            raise ValueError('Campaign configuration cannot contain URL credentials or arbitrary HTTP origins')
        timeout = value['timeout_seconds']
        if type(timeout) not in (int, float) or not isfinite(timeout) or not 0 < timeout <= 300:
            raise ValueError('Campaign timeout must be bounded and finite')
        if route_keys:
            route = value['network_route']
            _keys(route, ('endpoint', 'proxy', 'address', 'expires_at'))
            _text(route['proxy'], 128)
            proxy = urlsplit(route['proxy'])
            address = ipaddress.ip_address(route['address'])
            if (route['endpoint'] != value['endpoint'] or url.scheme != 'https'
                    or proxy.scheme != 'http' or proxy.hostname != '127.0.0.1'
                    or not proxy.port or proxy.username or proxy.password or proxy.path or proxy.query or proxy.fragment
                    or type(address) is not ipaddress.IPv4Address or not address.is_global
                    or address.is_reserved or address.is_multicast or str(address) != route['address']
                    or type(route['expires_at']) is not int or route['expires_at'] <= 0):
                raise ValueError('Invalid nonsecret administrator route projection')
    return value


def describe_campaign_transport(adapter):
    # ProviderStore's frozen restriction wrapper retains its immutable delegate.
    # Read only configuration fields; never credentials or environment values.
    delegate = getattr(adapter, 'delegate', adapter)
    if hasattr(delegate, 'endpoint') and hasattr(delegate, 'timeout_seconds'):
        value = {'kind': 'configured-network',
            'adapter_type': type(delegate).__module__ + '.' + type(delegate).__qualname__,
            'endpoint': delegate.endpoint, 'timeout_seconds': delegate.timeout_seconds}
        route = getattr(delegate, 'network_route', None)
        if route is not None:
            value['network_route'] = route
        return validate_transport(value)
    projection = getattr(delegate, 'campaign_transport', None)
    if type(projection) is not dict or projection.get('kind') != 'injected-test':
        raise ValueError('Injected campaign adapters must explicitly identify test transport configuration')
    return validate_transport(projection)


@dataclass(frozen=True)
class CampaignPlanningAdapter:
    delegate: object = field(repr=False)
    profile_json: str

    @property
    def campaign_profile(self):
        return _strict_json(self.profile_json, 8192)

    @property
    def adapter_name(self):
        return self.delegate.adapter_name

    @property
    def model_id(self):
        return self.delegate.model_id

    def verify(self, expected):
        if (self.campaign_profile != expected or self.adapter_name != expected['adapter_name']
                or self.model_id != expected['model_id']
                or describe_campaign_transport(self.delegate) != expected['transport']):
            raise ValueError('Campaign adapter profile or actual transport configuration changed')

    def plan(self, request_json):
        self.verify(self.campaign_profile)
        return self.delegate.plan(request_json)


def bind_campaign_adapter(adapter, profile):
    """The trusted caller/ProviderStore supplies profile identity, never the model."""
    from .evaluation_campaign import _profile
    profile = _profile(profile)
    bound = CampaignPlanningAdapter(adapter, canonical_json_bytes(profile).decode('utf-8'))
    bound.verify(profile)
    return bound

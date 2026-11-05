<?php

namespace App\Services;

use App\Models\AuditEvent;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\QueryException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;

class InventoryClient
{
    private array $responses = [];

    private const MUTATIONS = ['/api/inventory', '/api/admin/shop', '/api/admin/stock-sync', '/api/admin/reconcile', '/api/admin/dispatch', '/api/ebay/action'];

    public function authorize(): void
    {
        if (! auth()->user()?->is_admin) {
            throw new AuthorizationException('An administrator account is required.');
        }
    }

    private function request(string $method, string $path, array $parameters = []): Response
    {
        $key = config('inventory.key');
        if (! is_string($key) || ! preg_match('/^[a-f0-9]{64}$/', $key)) {
            throw ValidationException::withMessages(['service' => 'The private inventory connection needs configuration.']);
        }
        $origin = rtrim(config('app.url'), '/');
        $host = parse_url($origin, PHP_URL_HOST);
        $port = parse_url($origin, PHP_URL_PORT);
        try {
            $response = Http::baseUrl(config('inventory.url'))->acceptJson()->connectTimeout(3)->timeout(45)
                ->withHeaders(['X-Toga-Admin-Key' => $key, 'Origin' => $origin, 'Host' => $host.($port ? ':'.$port : ''), 'X-Forwarded-Proto' => parse_url($origin, PHP_URL_SCHEME)])
                ->send($method, $path, $method === 'GET' ? ['query' => $parameters] : ['json' => $parameters]);
        } catch (ConnectionException $exception) {
            throw ValidationException::withMessages(['service' => 'The inventory service did not confirm the request. Refresh stock before retrying any change.']);
        }

        return $response;
    }

    public function get(string $path): array
    {
        $this->authorize();
        if (! in_array($path, ['/api/inventory', '/api/admin/shop', '/api/ebay'], true)) {
            throw new AuthorizationException;
        }
        if (! isset($this->responses[$path])) {
            $response = $this->request('GET', $path);
            $this->requireSuccess($response);
            $this->responses[$path] = $response->json();
        }

        return $this->responses[$path];
    }

    public function mutate(string $path, array $parameters): Response
    {
        $this->authorize();
        if (! in_array($path, self::MUTATIONS, true)) {
            throw new AuthorizationException;
        }
        $audit = AuditEvent::create(['user_id' => auth()->id(), 'operation' => $path.':'.($parameters['action'] ?? 'update'), 'parameters' => Arr::only($parameters, ['cardId', 'quantity', 'price', 'expectedStock', 'orderId', 'mode', 'key', 'unitCost', 'unitPrice', 'fees', 'date', 'platform', 'condition', 'enabled']), 'outcome' => 'pending']);
        try {
            $response = $this->request('POST', $path, $parameters);
        } catch (ValidationException $exception) {
            $audit->update(['outcome' => 'unknown']);
            throw $exception;
        }
        try {
            $audit->update(['outcome' => $response->successful() ? 'succeeded' : 'rejected', 'status_code' => $response->status()]);
        } catch (QueryException $exception) {
            Log::warning('Admin audit completion needs reconciliation.', ['audit_id' => $audit->id]);
        }
        $this->responses = [];
        $this->requireSuccess($response);

        return $response;
    }

    private function requireSuccess(Response $response): void
    {
        if (! $response->successful()) {
            $message = $response->json('statusMessage');
            throw ValidationException::withMessages(['service' => is_string($message) ? mb_substr($message, 0, 300) : 'The inventory service rejected the request.']);
        }
    }

    public function export(string $kind): string
    {
        $this->authorize();
        abort_unless(in_array($kind, ['inventory', 'sales'], true), 404);
        $response = $this->request('GET', '/api/export', ['kind' => $kind]);
        $this->requireSuccess($response);

        return $response->body();
    }

    public function health(): array
    {
        foreach (['/api/health', '/api/admin/ping'] as $path) {
            $response = $this->request('GET', $path);
            $this->requireSuccess($response);
            if ($path === '/api/health') {
                $health = $response->json();
            }
        }

        return $health;
    }
}

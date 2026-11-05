<?php

namespace App\Http\Controllers;

use App\Services\InventoryClient;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Cookie;
use Symfony\Component\HttpFoundation\Cookie as ResponseCookie;

class AdminConnectionController extends Controller
{
    public function connect(InventoryClient $client): RedirectResponse
    {
        $response = $client->mutate('/api/ebay/action', ['action' => 'connect']);
        $url = $response->json('authorizationUrl');
        abort_unless(is_string($url) && parse_url($url, PHP_URL_SCHEME) === 'https' && parse_url($url, PHP_URL_HOST) === 'auth.ebay.com', 502);
        foreach ($response->toPsrResponse()->getHeader('Set-Cookie') as $value) {
            $cookie = ResponseCookie::fromString($value);
            if ($cookie->getName() === 'ebay_oauth_state') {
                Cookie::queue($cookie);
            }
        }

        return redirect()->away($url);
    }

    public function export(string $kind, InventoryClient $client): Response
    {
        return response($client->export($kind), 200, ['Content-Type' => 'text/csv; charset=utf-8', 'Content-Disposition' => 'attachment; filename="toga-'.$kind.'.csv"', 'Cache-Control' => 'no-store']);
    }
}

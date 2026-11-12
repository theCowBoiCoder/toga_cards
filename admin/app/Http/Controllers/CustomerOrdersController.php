<?php

namespace App\Http\Controllers;

use App\Services\InventoryClient;
use Illuminate\Contracts\View\View;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class CustomerOrdersController extends Controller
{
    public function index(InventoryClient $client): View
    {
        return view('customer.orders', ['orders' => $client->customer('orders')['orders']]);
    }

    public function show(string $orderId, InventoryClient $client): View
    {
        return view('customer.order', ['order' => $client->customer('order', ['orderId' => $orderId])['order']]);
    }

    public function checkout(Request $request, InventoryClient $client): JsonResponse
    {
        $data = $request->validate(['items' => 'required|array|min:1|max:50', 'items.*.id' => 'required|integer|min:1', 'items.*.quantity' => 'required|integer|min:1|max:10000']);

        return response()->json($client->customer('checkout', $data));
    }

    public function requestReturn(Request $request, string $orderId, InventoryClient $client): RedirectResponse
    {
        $data = $request->validate(['reason' => 'required|string|max:2000']);
        $client->customer('return', [...$data, 'orderId' => $orderId]);

        return back()->with('status', 'Your request has been sent. Updates will appear here.');
    }
}

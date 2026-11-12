@extends('customer.layout')
@section('title', 'My orders')
@section('content')
<h1>My orders</h1><p class="muted">Orders placed while signed in appear here. Guest orders are not automatically linked to an account.</p>
@forelse($orders as $order)<article class="panel"><div class="row"><div><h2>Order {{ substr($order['id'], 0, 8) }}</h2><span class="muted">{{ \Carbon\Carbon::parse($order['created'])->format('j M Y') }}</span></div><span class="badge">{{ $order['dispatched_at'] ? 'Dispatched' : ucfirst($order['status']) }}</span></div><p>@php($cardCount = array_sum(array_column($order['items'], 'quantity'))){{ $cardCount }} {{ $cardCount === 1 ? 'card' : 'cards' }} · £{{ number_format($order['total']/100,2) }}</p>@if($order['refunded'] > 0)<p>Refunded: £{{ number_format($order['refunded']/100,2) }}</p>@endif<a class="button" href="{{ route('customer.order', $order['id']) }}">View order & tracking</a></article>
@empty<div class="panel"><h2>No orders yet</h2><p>Your first order will appear here after you check out while signed in.</p><a class="button" href="/shop">Browse cards</a></div>@endforelse
@endsection

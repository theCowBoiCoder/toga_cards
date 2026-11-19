@php
    $delivery = json_decode($order['address'] ?? '{}', true) ?? [];
    $items = $order['items'] ?? [];
    $status = $order['status'] ?? 'pending';
@endphp
<div class="tc-order">
    <div class="tc-order-summary">
        <div>
            <span class="tc-label">Order reference</span>
            <p class="tc-reference">{{ $order['id'] }}</p>
            <p class="tc-muted">{{ filled($order['created'] ?? null) ? \Illuminate\Support\Carbon::parse($order['created'])->format('j M Y · H:i') : 'Date unavailable' }}</p>
        </div>
        <x-filament::badge :color="match ($status) { 'paid' => 'success', 'pending' => 'warning', 'expired', 'cancelled' => 'gray', default => 'info' }">{{ ucfirst(str_replace('_', ' ', $status)) }}</x-filament::badge>
    </div>
    <div class="tc-order-grid">
        <div class="tc-stack">
        <section class="tc-card">
            <div class="tc-card-heading"><x-heroicon-o-square-3-stack-3d /><h3>Order items</h3><span class="tc-muted">{{ count($items) }} {{ count($items) === 1 ? 'line' : 'lines' }}</span></div>
            <div class="tc-item-list">
                @forelse ($items as $item)
                    <div class="tc-order-item">
                        <div class="tc-item-number" aria-hidden="true">#{{ $item['number'] }}</div>
                        <div class="tc-item-description"><strong>{{ $item['player'] }}</strong><span class="tc-muted">#{{ $item['number'] }} · {{ $item['variant'] }}</span><span class="tc-muted">{{ $item['quantity'] }} × £{{ number_format($item['price'] / 100, 2) }}</span></div>
                        <strong class="tc-amount">£{{ number_format(($item['price'] * $item['quantity']) / 100, 2) }}</strong>
                    </div>
                @empty
                    <p class="tc-empty">No items recorded for this order.</p>
                @endforelse
            </div>
            <dl class="tc-order-totals">
                <div><dt>Items subtotal</dt><dd>£{{ number_format(collect($items)->sum(fn ($item) => $item['price'] * $item['quantity']) / 100, 2) }}</dd></div>
                <div><dt>{{ ($order['shipping_method'] ?? '') ?: 'Postage' }}</dt><dd>£{{ number_format(($order['shipping'] ?? 0) / 100, 2) }}</dd></div>
                <div class="tc-total"><dt>Order total</dt><dd>£{{ number_format(($order['total'] ?? 0) / 100, 2) }}</dd></div>
            </dl>
        </section>
        <section class="tc-card">
            <div class="tc-card-heading"><x-heroicon-o-receipt-refund /><h3>Refunds</h3></div>
            @forelse ($order['refunds'] ?? [] as $refund)
                <div class="tc-card-body tc-refund">
                    <div class="tc-refund-heading"><strong class="tc-amount">£{{ number_format($refund['amount'] / 100, 2) }}</strong><x-filament::badge :color="match ($refund['status']) { 'succeeded' => 'success', 'failed', 'canceled' => 'danger', default => 'warning' }">{{ ucfirst($refund['status']) }}</x-filament::badge></div>
                    <p class="tc-muted">{{ $refund['reason'] }}</p>
                    <p class="tc-reference tc-muted">{{ $refund['stripe_id'] ?? 'Awaiting confirmation' }}</p>
                </div>
            @empty
                <p class="tc-empty">No refunds recorded.</p>
            @endforelse
        </section>
        @if (!empty($order['returnRequest']))
            <section class="tc-card">
                <div class="tc-card-heading"><x-heroicon-o-arrow-uturn-left /><h3>Return request</h3><x-filament::badge color="gray">{{ ucfirst($order['returnRequest']['status']) }}</x-filament::badge></div>
                <div class="tc-card-body tc-stack">
                    <div><span class="tc-label">Customer request</span><p>{{ $order['returnRequest']['reason'] }}</p></div>
                    @if (filled($order['returnRequest']['response'] ?? null))
                        <div><span class="tc-label">Response to customer</span><p>{{ $order['returnRequest']['response'] }}</p></div>
                    @endif
                </div>
            </section>
        @endif
        </div>
        <div class="tc-order-aside">
            <section class="tc-card">
                <div class="tc-card-heading"><x-heroicon-o-user /><h3>Customer</h3></div>
                <div class="tc-card-body">
                    @if (filled($order['email'] ?? null))
                        <a class="tc-customer-email" href="mailto:{{ $order['email'] }}">{{ $order['email'] }}</a>
                    @else
                        <p class="tc-muted">No customer email yet.</p>
                    @endif
                </div>
            </section>
            <section class="tc-card">
                <div class="tc-card-heading"><x-heroicon-o-truck /><h3>Delivery</h3></div>
                <div class="tc-card-body">
                    @if (collect(['name', 'address.line1', 'address.line2', 'address.city', 'address.state', 'address.postal_code', 'address.country'])->contains(fn ($field) => filled(data_get($delivery, $field))))
                        <address class="tc-address">
                            @foreach (['name', 'address.line1', 'address.line2', 'address.city', 'address.state', 'address.postal_code', 'address.country'] as $field)
                                @if (filled(data_get($delivery, $field)))<span>{{ data_get($delivery, $field) }}</span>@endif
                            @endforeach
                        </address>
                    @else
                        <p class="tc-muted">Delivery details will appear after checkout.</p>
                    @endif
                    <div class="tc-delivery-status">
                        <span class="tc-label">Dispatch</span>
                        <p>{{ filled($order['dispatched_at'] ?? null) ? \Illuminate\Support\Carbon::parse($order['dispatched_at'])->format('j M Y · H:i') : 'Not dispatched' }}</p>
                    </div>
                    @if (filled($order['tracking_reference'] ?? null))
                        <div class="tc-delivery-status"><span class="tc-label">Postage / tracking reference</span><p class="tc-reference">{{ $order['tracking_reference'] }}</p></div>
                    @endif
                    @if (filled($order['carrier'] ?? null))
                        <div class="tc-delivery-status"><span class="tc-label">Carrier</span><p>{{ $order['carrier'] }}</p></div>
                    @endif
                    @if (filled($order['tracking_url'] ?? null) && str_starts_with($order['tracking_url'], 'https://'))
                        <div class="tc-delivery-status"><a class="tc-customer-email" href="{{ $order['tracking_url'] }}" target="_blank" rel="noopener noreferrer">Track delivery ↗</a></div>
                    @endif
                </div>
            </section>
        </div>
    </div>
</div>

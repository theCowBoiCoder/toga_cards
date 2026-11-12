<div>
    <h3>Order {{ $order['id'] }}</h3>
    <p>{{ $order['email'] ?? 'No customer email yet' }}</p>
    <ul>
        @foreach ($order['items'] ?? [] as $item)
            <li>{{ $item['quantity'] }} × {{ $item['player'] }} #{{ $item['number'] }} · {{ $item['variant'] }} · £{{ number_format($item['price'] / 100, 2) }} each</li>
        @endforeach
    </ul>
    <p>{{ ($order['shipping_method'] ?? '') ?: 'Postage' }} charged: £{{ number_format($order['shipping'] / 100, 2) }}</p>
    <p>Total: £{{ number_format($order['total'] / 100, 2) }}</p>
    <h4>Delivery details</h4>
    @php($delivery = json_decode($order['address'] ?? '{}', true) ?? [])
    <address style="font-style:normal">
        @foreach (['name', 'address.line1', 'address.line2', 'address.city', 'address.state', 'address.postal_code', 'address.country'] as $field)
            @if (filled(data_get($delivery, $field)))
                {{ data_get($delivery, $field) }}<br>
            @endif
        @endforeach
    </address>
    <p>{{ $order['tracking_reference'] ?? '' }}</p>
    <p>{{ $order['carrier'] ?? '' }}</p>
    @if(!empty($order['tracking_url']))<p><a href="{{ $order['tracking_url'] }}" target="_blank" rel="noopener noreferrer">Track delivery</a></p>@endif
    <h4>Refunds</h4>
    @foreach($order['refunds'] ?? [] as $refund)<p>£{{ number_format($refund['amount']/100,2) }} · {{ $refund['status'] }} · {{ $refund['stripe_id'] ?? 'Awaiting confirmation' }}<br>{{ $refund['reason'] }}</p>@endforeach
    @if(!empty($order['returnRequest']))
        <h4>Return request · {{ $order['returnRequest']['status'] }}</h4>
        <p>{{ $order['returnRequest']['reason'] }}</p><p>{{ $order['returnRequest']['response'] }}</p>
    @endif
</div>

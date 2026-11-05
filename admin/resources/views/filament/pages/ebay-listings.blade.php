<x-filament-panels::page>
    <x-filament::section heading="Seller connection">
        <p>{{ $this->connection()['connected'] ? 'Seller connected' : 'Seller connection required' }}</p>
        <p>Last import: {{ $this->connection()['lastSync'] ?: 'Never' }}</p>
        @if ($this->connection()['lastError']) <p>{{ $this->connection()['lastError'] }}</p> @endif
        @if ($this->connection()['notificationError']) <p>{{ $this->connection()['notificationError'] }}</p> @endif
        <form method="POST" action="{{ route('admin.ebay.connect') }}">@csrf <x-filament::button type="submit">Connect or reconnect eBay</x-filament::button></form>
    </x-filament::section>
    {{ $this->table }}
</x-filament-panels::page>

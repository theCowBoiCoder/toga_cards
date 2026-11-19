<x-filament-panels::page>
    @php($connection = $this->connection())
    <x-filament::section heading="Seller connection">
        <div class="tc-stack">
            <dl class="tc-info-grid">
                <div><dt>Account status</dt><dd><x-filament::badge :color="$connection['connected'] ? 'success' : 'warning'">{{ $connection['connected'] ? 'Connected' : 'Connection required' }}</x-filament::badge></dd></div>
                <div><dt>Last import</dt><dd>{{ filled($connection['lastSync'] ?? null) ? \Illuminate\Support\Carbon::parse($connection['lastSync'])->format('j M Y · H:i') : 'Not imported yet' }}</dd></div>
            </dl>
            @if ($connection['lastError'] ?? null) <p class="tc-alert" role="alert">{{ $connection['lastError'] }}</p> @endif
            @if ($connection['notificationError'] ?? null) <p class="tc-alert" role="alert">{{ $connection['notificationError'] }}</p> @endif
            <form method="POST" action="{{ route('admin.ebay.connect') }}">@csrf <x-filament::button type="submit" color="gray" icon="heroicon-o-link">{{ $connection['connected'] ? 'Reconnect eBay' : 'Connect eBay' }}</x-filament::button></form>
        </div>
    </x-filament::section>
    {{ $this->table }}
</x-filament-panels::page>

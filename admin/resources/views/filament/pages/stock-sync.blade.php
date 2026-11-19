<x-filament-panels::page>
    @php($status = $this->status())
    <x-filament::section heading="Manual eBay stock updates">
        <div class="tc-stack">
            <dl class="tc-info-grid">
                <div><dt>Current status</dt><dd><x-filament::badge :color="($status['running'] ?? false) ? 'info' : 'gray'">{{ ($status['running'] ?? false) ? 'Check running' : 'Idle' }}</x-filament::badge></dd></div>
                <div><dt>Last completed check</dt><dd>{{ filled($status['lastSuccess'] ?? null) ? \Illuminate\Support\Carbon::parse($status['lastSuccess'])->format('j M Y · H:i') : 'No completed checks' }}</dd></div>
            </dl>
            <p class="tc-muted">Website stock is the source of truth. Select a card in Cards &amp; stock and choose <strong>Update eBay stock</strong> to update its linked listings.</p>
            @if ($status['unmapped'] ?? 0) <p class="tc-alert">{{ $status['unmapped'] }} active eBay listings need matching before they can be updated. Website stock remains available.</p> @endif
            @if ($status['lastError'] ?? null) <p class="tc-alert" role="alert">{{ $status['lastError'] }}</p> @endif
            <p class="tc-muted">Quantity updates and retries run only when requested.</p>
        </div>
    </x-filament::section>
    {{ $this->table }}
</x-filament-panels::page>

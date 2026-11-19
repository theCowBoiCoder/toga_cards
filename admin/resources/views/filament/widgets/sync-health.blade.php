<x-filament-widgets::widget>
    @php($status = $this->status())
    <x-filament::section heading="Stock and shop readiness">
        <div class="tc-stack">
            <p class="tc-muted">Website stock is the source of truth. eBay quantities update only for cards you select.</p>
            @if ($status['unmapped'] ?? 0) <p class="tc-alert">{{ $status['unmapped'] }} eBay listings need matching before they can be updated. Your website can continue taking orders.</p> @endif
            @if ($status['lastError'] ?? null) <p class="tc-alert" role="alert">{{ $status['lastError'] }}</p> @endif
            <div class="tc-links">
                <x-filament::button color="gray" size="sm" tag="a" href="{{ \App\Filament\Pages\StockSync::getUrl() }}" icon="heroicon-o-arrow-path">Review eBay updates</x-filament::button>
                <x-filament::link href="/shop" icon="heroicon-o-arrow-top-right-on-square">View shop</x-filament::link>
            </div>
        </div>
    </x-filament::section>
</x-filament-widgets::widget>

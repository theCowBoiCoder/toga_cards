<x-filament-widgets::widget>
    <x-filament::section heading="Stock and shop readiness">
        <p>Website stock is authoritative. eBay quantities are updated only for cards you select.</p>
        @if ($this->status()['unmapped']) <p>{{ $this->status()['unmapped'] }} eBay listings still need matching before they can be updated. This does not block website sales.</p> @endif
        @if ($this->status()['lastError']) <p>{{ $this->status()['lastError'] }}</p> @endif
        <p>Use your account profile to change your password or enable authenticator-based two-factor authentication.</p>
        <x-filament::link href="{{ \App\Filament\Pages\StockSync::getUrl() }}">Review eBay updates</x-filament::link>
        <x-filament::link href="/shop">View shop</x-filament::link>
    </x-filament::section>
</x-filament-widgets::widget>

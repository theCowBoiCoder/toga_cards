<x-filament-widgets::widget>
    <x-filament::section heading="Stock and shop readiness">
        <p>{{ $this->status()['enabled'] ? 'Automatic stock protection is enabled.' : 'Automatic stock protection is not enabled.' }}</p>
        @if ($this->status()['unmapped']) <p>{{ $this->status()['unmapped'] }} eBay listings still need matching. Website allocations stay held until the matching and verification checks pass.</p> @endif
        @if ($this->status()['lastError']) <p>{{ $this->status()['lastError'] }}</p> @endif
        <p>Use your account profile to change your password or enable authenticator-based two-factor authentication.</p>
        <x-filament::link href="{{ \App\Filament\Pages\StockSync::getUrl() }}">Review stock protection</x-filament::link>
        <x-filament::link href="/shop">View shop</x-filament::link>
    </x-filament::section>
</x-filament-widgets::widget>

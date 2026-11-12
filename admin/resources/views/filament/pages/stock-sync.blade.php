<x-filament-panels::page>
    <x-filament::section heading="Manual eBay stock updates">
        <p>Website stock is authoritative. eBay quantities change only when you select Update eBay stock for a card.</p>
        <p>{{ $this->status()['running'] ? 'A stock check is running.' : 'No check currently running.' }}</p>
        <p>Last completed check: {{ $this->status()['lastSuccess'] ?: 'Never' }}</p>
        @if ($this->status()['unmapped']) <p>{{ $this->status()['unmapped'] }} active eBay listings need matching before those listings can be updated. Website stock remains available.</p> @endif
        @if ($this->status()['lastError']) <p>{{ $this->status()['lastError'] }}</p> @endif
        <p>Select a card in Cards &amp; stock to update its linked listings. No automatic quantity updates or retries run.</p>
    </x-filament::section>
    {{ $this->table }}
</x-filament-panels::page>

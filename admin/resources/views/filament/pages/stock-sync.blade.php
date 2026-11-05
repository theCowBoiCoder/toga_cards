<x-filament-panels::page>
    <x-filament::section heading="Channel stock protection">
        <p>{{ $this->status()['enabled'] ? 'Enabled · checks every two minutes and after stock changes' : 'Not enabled' }}</p>
        <p>{{ $this->status()['running'] ? 'A stock check is running.' : 'No check currently running.' }}</p>
        <p>Last completed check: {{ $this->status()['lastSuccess'] ?: 'Never' }}</p>
        @if ($this->status()['unmapped']) <p>{{ $this->status()['unmapped'] }} active listings need matching before new website stock can be released.</p> @endif
        @if ($this->status()['lastError']) <p>{{ $this->status()['lastError'] }}</p> @endif
        <p>Automatic updates only reduce quantities. Additional receipts and restocks need physical confirmation.</p>
    </x-filament::section>
    {{ $this->table }}
</x-filament-panels::page>

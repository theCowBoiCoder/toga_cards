<?php

namespace App\Filament\Pages;

use Filament\Tables\Columns\TextColumn;

class StockSync extends RecordsPage
{
    protected static ?string $title = 'Stock synchronisation';

    protected static ?string $navigationLabel = 'Stock synchronisation';

    protected static ?int $navigationSort = 70;

    protected string $view = 'filament.pages.stock-sync';

    public function status(): array
    {
        return $this->client()->get('/api/admin/shop')['stockSync'];
    }

    protected function sourceRows(): array
    {
        return collect($this->status()['jobs'])->map(fn (array $row): array => [...$row, 'id' => $row['card_id']])->all();
    }

    protected function columns(): array
    {
        return [TextColumn::make('player'), TextColumn::make('number')->label('#'), TextColumn::make('variant'), TextColumn::make('status')->badge(), TextColumn::make('verified_at')->dateTime()->placeholder('Pending'), TextColumn::make('attempts'), TextColumn::make('error')->wrap()];
    }

    protected function getHeaderActions(): array
    {
        return [$this->adminAction('enable')->label('Enable stock protection')->visible(fn (): bool => ! $this->status()['enabled'])->requiresConfirmation()->modalDescription('Enable verified quantity reductions for linked eBay listings.')->action(fn () => $this->perform('/api/admin/stock-sync', ['action' => 'enable'], 'Stock protection enabled')),
            $this->adminAction('check')->label('Check stock now')->visible(fn (): bool => $this->status()['enabled'])->action(fn () => $this->perform('/api/admin/stock-sync', ['action' => 'sync'], 'Stock check queued')),
            $this->adminAction('pause')->label('Pause sync and website purchasing')->visible(fn (): bool => $this->status()['enabled'])->color('danger')->requiresConfirmation()->action(fn () => $this->perform('/api/admin/stock-sync', ['action' => 'pause'], 'Stock sync and website purchasing paused'))];
    }
}

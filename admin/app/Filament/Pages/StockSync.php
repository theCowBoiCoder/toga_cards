<?php

namespace App\Filament\Pages;

use Filament\Tables\Columns\TextColumn;

class StockSync extends RecordsPage
{
    protected static ?string $title = 'eBay stock updates';

    protected static ?string $navigationLabel = 'eBay stock updates';

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

    protected function rowActions(): array
    {
        return [$this->adminAction('updateEbay')->label('Update eBay stock')->requiresConfirmation()
            ->modalDescription('Update only this card’s linked eBay listings from current website availability. If several listings are linked, the first receives the stock and the others are set to zero. Prices stay unchanged. Future stock changes require another update.')
            ->action(fn (array $record) => $this->perform('/api/admin/stock-sync', ['action' => 'sync', 'cardIds' => [$record['card_id']]], 'Selected eBay stock updated'))];
    }
}

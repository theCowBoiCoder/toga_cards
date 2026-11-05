<?php

namespace App\Filament\Pages;

use Filament\Tables\Columns\TextColumn;

class EbayOrders extends RecordsPage
{
    protected static ?string $title = 'eBay order review';

    protected static ?string $navigationLabel = 'eBay order review';

    protected static ?int $navigationSort = 60;

    protected function sourceRows(): array
    {
        return collect($this->client()->get('/api/ebay')['orders'])->map(fn (array $row): array => [...$row, 'id' => hash('sha256', $row['key'])])->all();
    }

    protected function columns(): array
    {
        return [TextColumn::make('created')->dateTime()->sortable(), TextColumn::make('title')->wrap(), TextColumn::make('quantity'), TextColumn::make('gross')->money('GBP', divideBy: 100), TextColumn::make('disposition')->badge(), TextColumn::make('issue')->wrap()->limit(160)];
    }

    protected function rowActions(): array
    {
        return [$this->adminAction('alreadyCounted')->label('Already in stock count')->visible(fn (array $record): bool => ! $record['saleId'])->requiresConfirmation()->modalDescription('Use this only when the sold copies have already been removed from your physical inventory count.')->action(fn (array $record) => $this->perform('/api/ebay/action', ['action' => 'review', 'key' => $record['key'], 'mode' => 'already-counted', 'fees' => 0], 'Order marked already counted')),
            $this->adminAction('apply')->label('Record sale')->visible(fn (array $record): bool => ! $record['saleId'])->schema([$this->moneyInput('fees', 'Total fees and net postage cost')])->action(fn (array $data, array $record) => $this->perform('/api/ebay/action', ['action' => 'review', 'key' => $record['key'], 'mode' => 'apply', 'fees' => $this->pence($data['fees'])], 'Sale recorded')),
            $this->adminAction('fees')->label('Confirm fees')->visible(fn (array $record): bool => (bool) $record['saleId'])->schema([$this->moneyInput('fees', 'Total fees and net postage cost')])->action(fn (array $data, array $record) => $this->perform('/api/ebay/action', ['action' => 'review', 'key' => $record['key'], 'mode' => 'fees', 'fees' => $this->pence($data['fees'])], 'Fees confirmed'))];
    }
}

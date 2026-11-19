<?php

namespace App\Filament\Pages;

use Filament\Tables\Columns\TextColumn;

class Emails extends RecordsPage
{
    protected static string|\UnitEnum|null $navigationGroup = 'Shop management';

    protected static string|\BackedEnum|null $navigationIcon = 'heroicon-o-envelope';

    protected static ?int $navigationSort = 35;

    protected static ?string $title = 'Order emails';

    public function getSubheading(): ?string
    {
        return $this->client()->get('/api/admin/emails')['message'];
    }

    protected function sourceRows(): array
    {
        return $this->client()->get('/api/admin/emails')['emails'];
    }

    protected function columns(): array
    {
        return [
            TextColumn::make('created')->dateTime()->sortable(),
            TextColumn::make('order_id')->label('Order reference')->limit(12)->copyable(),
            TextColumn::make('kind')->label('Email')->formatStateUsing(fn (string $state): string => ucfirst(str_replace('-', ' ', $state))),
            TextColumn::make('audience')->label('Recipient'),
            TextColumn::make('status')->badge(),
            TextColumn::make('attempts'),
            TextColumn::make('sent_at')->label('Accepted by email provider')->dateTime()->placeholder('Not sent'),
            TextColumn::make('error_code')->label('Delivery error')->placeholder('None'),
        ];
    }

    protected function rowActions(): array
    {
        return [
            $this->adminAction('retry')->label('Retry email')
                ->visible(fn (array $record): bool => $record['status'] === 'failed')
                ->requiresConfirmation()
                ->modalDescription('Queue this failed message again. A provider timeout can mean an earlier attempt was accepted, so check provider logs if its delivery is uncertain.')
                ->action(fn (array $record) => $this->perform('/api/admin/emails', ['id' => $record['id']], 'Email queued for another attempt')),
        ];
    }
}

<?php

namespace App\Filament\Pages;

use Filament\Tables\Columns\TextColumn;

class Sales extends RecordsPage
{
    protected static string|\UnitEnum|null $navigationGroup = 'Shop management';

    protected static string|\BackedEnum|null $navigationIcon = 'heroicon-o-chart-bar';

    protected ?string $subheading = 'Track recorded sales, item revenue and selling costs.';

    protected static ?int $navigationSort = 40;

    protected function sourceRows(): array
    {
        return $this->client()->get('/api/inventory')['sales'];
    }

    protected function columns(): array
    {
        return [TextColumn::make('date')->sortable(), TextColumn::make('player'), TextColumn::make('number')->label('#'), TextColumn::make('quantity'), TextColumn::make('gross')->money('GBP', divideBy: 100), TextColumn::make('fees')->money('GBP', divideBy: 100), TextColumn::make('cost')->money('GBP', divideBy: 100), TextColumn::make('platform')->badge(), TextColumn::make('ebay_fees_confirmed')->label('Fees')->formatStateUsing(fn ($state): string => $state === 0 ? 'Provisional' : 'Recorded')];
    }

    protected function getHeaderActions(): array
    {
        return [$this->adminAction('export')->label('Export sales')->url(route('admin.export', ['kind' => 'sales']))];
    }
}
